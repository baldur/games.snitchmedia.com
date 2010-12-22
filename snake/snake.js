$(function() {
    var direction = "u";
    var $cage = $('#cage');
    var width = $cage.width();
    var height = $cage.height();
    var $snake = $('#snake');
    var top = function() { return $snake.position().top; };
    var left = function() { return $snake.position().left; };
    var collisionChecker = new Worker("snake_worker_1.js");
    setInterval(function() {
        var message = ['check', direction, { width: width, height: height }, {top: top(), left: left()}];
        collisionChecker.postMessage(message);
    }, 100);

    // Triggered by postMessage in the Web Worker
    collisionChecker.onmessage = function (evt) {
       if(evt.data === "ok"){
           switch(direction) {
               case "r":
                   $snake.css('left', $snake.position().left + 5);
               break;
               case "l":
                   $snake.css('left', $snake.position().left - 5);
               break;
               case "d":
                   $snake.css('top', $snake.position().top + 5);
               break;
               case "u":
                   $snake.css('top', $snake.position().top - 5);
               break;
           }
       }
    };
    // If the Web Worker throws an error
    collisionChecker.onerror = function (evt) {
       console.log("bad stuff in wokrer");
       console.log(evt.data);
    };


   $(document).keydown(function(e){
       console.log(e.keyCode);
       switch(e.keyCode) {
           case 37:
               direction = 'l';
           break;
           case 38:
               direction = 'u';
           break;
           case 39:
               direction = 'r';
           break;
           case 40:
               direction = 'd';
           break;
       } 
   }); 

});
