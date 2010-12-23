$(function() {
    var LEFT = 37
    var RIGHT = 39
    var UP = 38
    var DOWN = 40
    var direction = RIGHT;
    var $cage = $('#cage');
    var width = $cage.width();
    var height = $cage.height();
    var $snake = $('#snake');
    var snakeArray = [$snake];

    var $AnewDot = $snake.clone().css('left',$snake.position().left-5);
    $cage.append($AnewDot);
    snakeArray.push($AnewDot);
    var growSnake = function() {
        var $newDot;
        switch(direction) {
        case LEFT:
            $newDot = $snake.clone().css('left',$snake.position().left-5);
            break;
        case RIGHT:
            $newDot = $snake.clone().css('left',$snake.position().left+5);
            break;
        case UP:
            $newDot = $snake.clone().css('top',$snake.position().top+5);
            break;
        case DOWN:
            $newDot = $snake.clone().css('top',$snake.position().top-5);
            break;
        }
        $cage.append($newDot);
        snakeArray.push($newDot);
    }

    var growerId = setInterval(function() {
        growSnake();
    }, 1000);
    
    var top = function() { return snakeArray[0].position().top; };
    var left = function() { return snakeArray[0].position().left; };

    var collisionChecker = new Worker("snake_worker_1.js");

    var moverId = setInterval(function() {
        var checkWallMessage = ['checkWall', direction, { width: width, height: height }, {top: top(), left: left()}];
        collisionChecker.postMessage(checkWallMessage);
        
        var checkSnakeMessage = ['checkSnake', direction, {top: top(), left: left()}, {x: $.map(snakeArray, function(val,index){return val.position().left}), y: $.map(snakeArray, function(val,index){return val.position().top}) }];
        collisionChecker.postMessage(checkSnakeMessage);
    }, 50);

    // Triggered by postMessage in the Web Worker
    collisionChecker.onmessage = function (evt) {
       if(evt.data[0] === "wall" && evt.data[1] === "ok"){
           switch(direction) {
               case RIGHT:
                   moving = snakeArray.pop();
                   first = snakeArray[0];
                   moving.css('top', first.position().top);
                   moving.css('left', first.position().left + 5);
                   snakeArray.unshift(moving);
               break;
               case LEFT:
                   moving = snakeArray.pop();
                   first = snakeArray[0];
                   moving.css('top', first.position().top);
                   moving.css('left', first.position().left - 5);
                   snakeArray.unshift(moving);
               break;
               case DOWN:
                   moving = snakeArray.pop();
                   first = snakeArray[0];
                   moving.css('top', first.position().top + 5);
                   moving.css('left', first.position().left);
                   snakeArray.unshift(moving);
               break;
               case UP:
                   moving = snakeArray.pop();
                   first = snakeArray[0];
                   moving.css('top', first.position().top - 5);
                   moving.css('left', first.position().left);
                   snakeArray.unshift(moving);
               break;
           }
       } else if(evt.data[0] === "snake") {
           console.log("joy ride over");
           console.log(evt.data[1]);
           console.log(evt.data[2]);
           console.log(evt.data[3]);
           clearInterval(moverId);
       } else {
           clearInterval(moverId);
       }
    };
    // If the Web Worker throws an error
    collisionChecker.onerror = function (evt) {
       console.log("bad stuff in wokrer");
       console.log(evt.data);
    };


   $(document).keydown(function(e){
       if(direction !== e.keyCode) {
           if( (direction === RIGHT || direction === LEFT) && (e.keyCode === LEFT || e.keyCode === RIGHT)) {
             console.log("can't reverse");
           } else if ( (direction === UP || direction === DOWN) && (e.keyCode === UP || e.keyCode === DOWN)) {
             console.log("can't reverse");
           } else {
             direction = e.keyCode;
           }
       } else {
           console.log("already going that way");
       }
   }); 

});
