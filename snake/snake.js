$(function() {
    var LEFT = 37
    var RIGHT = 39
    var UP = 38
    var DOWN = 40
    var direction = DOWN;
    var $cage = $('#cage');
    var width = $cage.width();
    var height = $cage.height();
    var $snake = $('#snake');

    var $newDot = $snake.clone().css('left',$snake.position().left-5);
    var $newDot2 = $snake.clone().css('left',$snake.position().left-10);
    var $newDot3 = $snake.clone().css('left',$snake.position().left-15);
    var $newDot4 = $snake.clone().css('left',$snake.position().left-20);
    var $newDot5 = $snake.clone().css('left',$snake.position().left-25);
    var $newDot6 = $snake.clone().css('left',$snake.position().left-30);
    var $newDot7 = $snake.clone().css('left',$snake.position().left-35);

    $cage.append($newDot);
    $cage.append($newDot2);
    $cage.append($newDot3);
    $cage.append($newDot4);
    $cage.append($newDot5);
    $cage.append($newDot6);
    $cage.append($newDot7);
    var snakeArray = [$snake,$newDot,$newDot2,$newDot3,$newDot4,$newDot5,$newDot6,$newDot7];

    var top = function() { return snakeArray[0].position().top; };
    var left = function() { return snakeArray[0].position().left; };

    var randomeDot = function(){ 
        var top = Math.floor(Math.random()*height);
        var left = Math.floor(Math.random()*width);
        var $dot = $snake.clone();
        $dot.css('left', left); 
        $dot.css('top', top); 
        $cage.append($dot);
    };

    //randomeDot();
    //randomeDot();
    //randomeDot();

    var collisionChecker = new Worker("snake_worker_1.js");

    var moverId = setInterval(function() {
        var checkWallMessage = ['checkWall', direction, { width: width, height: height }, {top: top(), left: left()}];
        collisionChecker.postMessage(checkWallMessage);
        
        var checkSnakeMessage = ['checkSnake', direction, {top: top(), left: left()}, {x: $.map(snakeArray, function(val,index){return val.position().left}), y: $.map(snakeArray, function(val,index){return val.position().top}) }];
        collisionChecker.postMessage(checkSnakeMessage);
    }, 500);

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
