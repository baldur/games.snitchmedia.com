$(function(){

    var direction = -1;
    var distance = 5;
    setInterval(function() {
        var $ball = $('#ball');
        var $field = $('#field');
        var $leftPaddle = $('#left_paddle');
        var $rightPaddle = $('#right_paddle');
        var currentLeft = parseInt($ball.css('left'), 10);
        if( currentLeft < parseInt($leftPaddle.css( 'left' ), 10 ) + distance ) {
            direction = 1;
        }

        if( currentLeft > $field.width() - distance * 2 ) {
            direction = -1;
        }
        var newLeft = currentLeft + (direction*distance);
        $ball.css('left', newLeft);
    }, 30);

});

$(function(){
    var mover = function(paddle, direction) {
        var topPos = parseInt( paddle.css( 'top' ), 10 );
        paddle.css( 'top', topPos + ( 5*direction ) ); 
    };
    $(document).keydown(function(e) {
        var leftUp = function(){ 
            mover($('#left_paddle'), -1);
        };
        var leftDown = function(){
            mover($('#left_paddle'), 1);
        };
        var rightUp = function(){
            mover($('#right_paddle'), -1);
        };
        var rightDown = function(){
            mover($('#right_paddle'), 1);
        };
        var directions = { 65  : leftUp,
                           90  : leftDown,
                           191 : rightDown,
                           222 : rightUp };

        directions[e.which]();
        e.preventDefault();
    });
});
